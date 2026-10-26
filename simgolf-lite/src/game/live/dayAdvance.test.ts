import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Terrain, World } from "../models/types";
import { recordLivingClubRound } from "../livingClub/livingClub";
import type { CompletedRound } from "../retention/types";
import { FIXED_GAME_STEP_MINUTES } from "./clock";
import { createDayAdvanceRequest, runDayAdvanceChunk, type DayAdvanceRequest } from "./dayAdvance";
import { LIVE } from "./liveConfig";
import { courseCanReceiveLiveArrivals, createLiveState, stepLive, type StepEvents } from "./simulation";

function fixture(dayIndex = 0) {
  const width = 60;
  const height = 24;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 4, y: 12 };
  const green = { x: 50, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles[(green.y + dy) * width + green.x + dx] = "green";
  const course: Course = {
    name: "Bounded Links", width, height, tiles, elevations: new Array(width * height).fill(0),
    holes: [{ tee, green, parMode: "AUTO" }], obstacles: [], buildings: [],
    yardsPerTile: 10, baseGreenFee: 65, condition: 0.8,
  };
  let world: World = structuredClone(DEFAULT_WORLD);
  const live = createLiveState(course, world, dayIndex);
  // A real deterministic booked arrival keeps this equivalence fixture small.
  live.arrivals = live.arrivals.slice(0, 1);
  expect(live.arrivals).toHaveLength(1);
  const completedRounds: CompletedRound[] = [];
  const cashRecords: Array<{ minute: number; delta: number }> = [];
  const step = (minutes: number) => stepLive(live, course, minutes, world);
  const onEvents = (events: StepEvents) => {
    for (const round of events.completedRounds) {
      world = recordLivingClubRound(world, course, round, live.dayIndex);
      completedRounds.push(round);
    }
    if (events.cashDelta > 0) {
      cashRecords.push({ minute: live.dayMinute, delta: events.cashDelta });
      world = { ...world, cash: world.cash + events.cashDelta };
    }
  };
  return { course, live, step, onEvents, completedRounds, cashRecords, world: () => world };
}

function drain(f: ReturnType<typeof fixture>, request: DayAdvanceRequest, maxSteps = 17) {
  let total = 0;
  while (request.status === "running" && total < 30_000) {
    const result = runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: f.onEvents, maxSteps, now: () => 0 });
    expect(result.steps).toBeLessThanOrEqual(maxSteps);
    total += result.steps;
  }
  expect(request.status).not.toBe("running");
  return total;
}

describe("bounded day advance", () => {
  it("matches ordinary fixed stepping, real cash events, completed rounds, and world records", () => {
    const ordinary = fixture();
    let ordinarySteps = 0;
    while (!ordinary.live.dayOver && ordinarySteps++ < 30_000) ordinary.onEvents(ordinary.step(FIXED_GAME_STEP_MINUTES));
    expect(ordinary.live.dayOver).toBe(true);
    const chunked = fixture();
    const request = createDayAdvanceRequest(chunked.live, "finish-day");
    expect(drain(chunked, request)).toBe(ordinarySteps);
    expect(request.status).toBe("day-over");
    expect(chunked.live).toEqual(ordinary.live);
    expect(chunked.cashRecords).toEqual(ordinary.cashRecords);
    expect(chunked.cashRecords.length).toBeGreaterThan(0);
    expect(chunked.completedRounds).toEqual(ordinary.completedRounds);
    expect(chunked.completedRounds).toHaveLength(1);
    expect(chunked.world()).toEqual(ordinary.world());
  });

  it("stops at an arrival, then a new shot begin, without treating the current shot as new", () => {
    const f = fixture();
    const arrival = createDayAdvanceRequest(f.live, "next-event");
    drain(f, arrival);
    expect(arrival.status).toBe("complete");
    expect(f.live.nextArrivalIdx).toBe(1);
    expect(f.live.roundsFinished).toBe(0);
    const shot = createDayAdvanceRequest(f.live, "next-event");
    drain(f, shot);
    expect(f.live.golfers.some((g) => g.segments[g.segIndex]?.kind === "flight")).toBe(true);
    const following = createDayAdvanceRequest(f.live, "next-event");
    const initialFlight = f.live.golfers[0].segments[f.live.golfers[0].segIndex];
    const first = runDayAdvanceChunk({ request: following, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: f.onEvents, maxSteps: 1 });
    expect(first.status).toBe("running");
    drain(f, following);
    expect(following.status).toBe("complete");
    expect(f.live.roundsFinished > 0 || f.live.golfers[0].segments[f.live.golfers[0].segIndex] !== initialFlight).toBe(true);
  });

  it("stops at round completion as a meaningful event", () => {
    const f = fixture();
    drain(f, createDayAdvanceRequest(f.live, "next-event"));
    let events = 0;
    while (f.live.roundsFinished === 0 && events++ < 30) {
      const request = createDayAdvanceRequest(f.live, "next-event");
      drain(f, request);
      expect(request.status).toBe("complete");
    }
    expect(f.live.roundsFinished).toBe(1);
    expect(f.live.dayOver).toBe(false);
  });

  it.each([0, 6])("stops exactly at dayOver on day %i and cannot consume a replacement day", (dayIndex) => {
    const f = fixture(dayIndex);
    f.live.arrivals = [];
    f.live.dayMinute = LIVE.day.closeMinute - FIXED_GAME_STEP_MINUTES;
    const request = createDayAdvanceRequest(f.live, "finish-day");
    const result = runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, maxSteps: 64 });
    expect(result).toMatchObject({ status: "day-over", steps: 1 });
    expect(f.live.dayMinute).toBe(LIVE.day.closeMinute);
    expect(f.live.dayIndex).toBe(dayIndex);
    expect(f.world().week).toBe(DEFAULT_WORLD.week);
    const next = createLiveState(f.course, f.world(), (dayIndex + 1) % 7);
    const step = vi.fn();
    expect(runDayAdvanceChunk({ request, live: next, canReceiveArrivals: true, step }).steps).toBe(0);
    const wrongDay = createDayAdvanceRequest(f.live, "finish-day");
    expect(runDayAdvanceChunk({ request: wrongDay, live: next, canReceiveArrivals: true, step })).toMatchObject({ status: "invalid", reason: "day-changed", steps: 0 });
    expect(step).not.toHaveBeenCalled();
  });

  it("yields by step or wall budget and cancels between quanta without replaying callbacks", () => {
    const f = fixture();
    const request = createDayAdvanceRequest(f.live, "finish-day");
    const events = vi.fn(f.onEvents);
    expect(runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: events, maxSteps: 3, now: () => 0 })).toMatchObject({ status: "running", steps: 3, gameMinutes: 3 * FIXED_GAME_STEP_MINUTES });
    let time = 0;
    expect(runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: events, now: () => time += 9 })).toMatchObject({ status: "running", steps: 1 });
    expect(runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: events, isCancelled: () => events.mock.calls.length >= 6, now: () => 0 })).toMatchObject({ status: "cancelled", steps: 2 });
    expect(events).toHaveBeenCalledTimes(6);
    expect(runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, onEvents: events }).steps).toBe(0);
    expect(events).toHaveBeenCalledTimes(6);
  });

  it("supports an owner completion predicate inside a bounded chunk", () => {
    const f = fixture();
    const startedAt = f.live.dayMinute;
    const request = createDayAdvanceRequest(f.live, "until");
    expect(runDayAdvanceChunk({ request, live: f.live, canReceiveArrivals: true, step: f.step, isComplete: (live) => live.dayMinute >= startedAt + 0.1, now: () => 0 })).toMatchObject({ status: "complete", steps: 2 });
  });

  it("uses the existing unopened-course guard", () => {
    const f = fixture();
    const closedCourse: Course = { ...f.course, holes: [], layouts: [{ id: "course-primary", name: "Unopened", draftHoleIds: [], publishedHoleIds: [], roundLength: 9, state: "closed", greenFee: 65 }] };
    const live = createLiveState(closedCourse, f.world(), 0);
    const step = vi.fn();
    expect(courseCanReceiveLiveArrivals(closedCourse)).toBe(false);
    expect(runDayAdvanceChunk({ request: createDayAdvanceRequest(live, "finish-day"), live, canReceiveArrivals: false, step })).toMatchObject({ status: "ineligible", reason: "unopened-course", steps: 0 });
    expect(step).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5, 257, NaN, Infinity])("rejects an invalid step budget %s without stepping", (maxSteps) => {
    const f = fixture();
    const step = vi.fn();
    expect(runDayAdvanceChunk({ request: createDayAdvanceRequest(f.live, "finish-day"), live: f.live, canReceiveArrivals: true, step, maxSteps })).toMatchObject({ status: "invalid", reason: "invalid-budget", steps: 0 });
    expect(step).not.toHaveBeenCalled();
  });

  it("rejects missing completion, invalid wall budget, and a step that makes no progress", () => {
    const f = fixture();
    const step = vi.fn(() => ({ cashDelta: 0, finishedThisStep: 0, completedRounds: [] }));
    const base = { live: f.live, canReceiveArrivals: true, step };
    expect(runDayAdvanceChunk({ ...base, request: createDayAdvanceRequest(f.live, "until") })).toMatchObject({ status: "invalid", reason: "missing-completion", steps: 0 });
    expect(runDayAdvanceChunk({ ...base, request: createDayAdvanceRequest(f.live, "finish-day"), maxWallMs: 0 })).toMatchObject({ status: "invalid", reason: "invalid-budget", steps: 0 });
    expect(runDayAdvanceChunk({ ...base, request: createDayAdvanceRequest(f.live, "finish-day") })).toMatchObject({ status: "invalid", reason: "no-progress", steps: 1 });
    expect(step).toHaveBeenCalledTimes(1);
  });
});
