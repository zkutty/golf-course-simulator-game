import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "./models/defaults";
import {
  assignHoleToLayout,
  courseForLayout,
  normalizeCourseLayouts,
  publishLayout,
  selectLayout,
  updateLayout,
  validateDraftRouting,
} from "./models/courseLayouts";
import type { Course } from "./models/types";
import { createReferenceCourse, createTournamentStandardsCourse } from "./testing/referenceCourse";
import { planEstateDay } from "./live/spawn";
import { createLiveState, stepLive } from "./live/simulation";
import { snapshotLiveSimulation, restoreLiveSimulation } from "./live/persistence";
import { commitDay } from "./live/commitDay";
import { perCourseTotalsReconcile } from "./sim/courseOperations";
import { emptyCourseRecords, recordCompletedRound } from "./retention/records";
import { createTournamentEvent } from "./tournaments/tournaments";
import { normalizeLoadedSaveResult } from "../utils/save";
import { tickWeek } from "./sim/tickWeek";

function multiCourse(): Course {
  const base = createTournamentStandardsCourse();
  const first = base.holes.map((hole, index) => ({ ...hole, id: `north-${index + 1}`, name: `North ${index + 1}` }));
  const second = base.holes.slice(0, 9).map((hole, index) => ({ ...hole, id: `south-${index + 1}`, name: `South ${index + 1}` }));
  return normalizeCourseLayouts({
    ...base,
    holes: [...first, ...second],
    layouts: [
      { id: "north", name: "North Course", draftHoleIds: first.map((hole) => hole.id!), publishedHoleIds: first.map((hole) => hole.id!), roundLength: 18, state: "open", greenFee: 120 },
      { id: "south", name: "South Course", draftHoleIds: second.map((hole) => hole.id!), publishedHoleIds: second.map((hole) => hole.id!), roundLength: 9, state: "open", greenFee: 55 },
    ],
    activeCourseId: "north",
  });
}

function compactLiveCourse(): Course {
  const base = createReferenceCourse();
  const north = { ...base.holes[0], id: "north-1", name: "North 1" };
  const south = { ...base.holes[0], id: "south-1", name: "South 1" };
  return normalizeCourseLayouts({ ...base, holes: [north, south], layouts: [
    { id: "north", name: "North Course", draftHoleIds: [north.id], publishedHoleIds: [north.id], roundLength: 9, state: "open", greenFee: 120, legacyPartial: true },
    { id: "south", name: "South Course", draftHoleIds: [south.id], publishedHoleIds: [south.id], roundLength: 9, state: "open", greenFee: 55, legacyPartial: true },
  ], activeCourseId: "north" });
}

describe("M26 multi-course property operations", () => {
  it("migrates stable IDs, supports 36 holes, and round-trips named layouts", () => {
    const source = multiCourse();
    const extra = Array.from({ length: 9 }, (_, index) => ({ ...source.holes[index], id: `academy-${index + 1}` }));
    const course = normalizeCourseLayouts({ ...source, holes: [...source.holes, ...extra] });
    expect(course.holes).toHaveLength(36);
    expect(new Set(course.holes.map((hole) => hole.id)).size).toBe(36);
    const parsed = normalizeLoadedSaveResult({ schemaVersion: 9, savedAt: 1, course, world: DEFAULT_WORLD });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.course.layouts).toEqual(course.layouts);
      expect(parsed.payload.course.holes.map((hole) => hole.id)).toEqual(course.holes.map((hole) => hole.id));
    }
  });

  it("keeps draft edits separate and publishes only complete unique 9/18-hole routings", () => {
    const course = multiCourse();
    const north = course.layouts![0];
    const shortened = updateLayout(course, north.id, { draftHoleIds: north.draftHoleIds.slice(0, 8) });
    expect(validateDraftRouting(shortened, north.id).reasons).toContain("Routing must contain exactly 9 or 18 holes.");
    expect(shortened.layouts![0].publishedHoleIds).toHaveLength(18);
    expect(publishLayout(shortened, north.id).course.layouts![0].publishedHoleIds).toHaveLength(18);

    const reorderedIds = [...north.draftHoleIds].reverse();
    const reordered = updateLayout(course, north.id, { draftHoleIds: reorderedIds });
    const published = publishLayout(reordered, north.id);
    expect(published.reasons).toEqual([]);
    expect(published.course.layouts![0].publishedHoleIds).toEqual(reorderedIds);
    expect(selectLayout(published.course, "south").baseGreenFee).toBe(55);

    const transferred = assignHoleToLayout(course, "south", north.draftHoleIds[0]);
    expect(transferred.layouts!.find((layout) => layout.id === "north")!.draftHoleIds).not.toContain(north.draftHoleIds[0]);
    expect(transferred.layouts!.find((layout) => layout.id === "south")!.draftHoleIds).toContain(north.draftHoleIds[0]);
  }, 20_000);

  it("plans deterministic course bookings and routes golfers only through the booked course", () => {
    const course = compactLiveCourse();
    const world = { ...DEFAULT_WORLD, runSeed: 260026, reputation: 80 };
    const first = planEstateDay(course, world, 991);
    expect(planEstateDay(course, world, 991)).toEqual(first);
    expect(new Set(first.map((arrival) => arrival.courseId))).toEqual(new Set(["north", "south"]));

    const live = createLiveState(course, world, 0);
    live.dayMinute = (live.arrivals[0]?.atMinute ?? 20) - 1;
    stepLive(live, course, 2);
    expect(live.golfers.length).toBeGreaterThan(0);
    for (const golfer of live.golfers) {
      const allowed = new Set(courseForLayout(course, golfer.courseId).holes.map((hole) => hole.id));
      expect(golfer.holeIds?.every((id) => allowed.has(id))).toBe(true);
      expect(golfer.segments.filter((segment) => segment.holeId).every((segment) => allowed.has(segment.holeId!))).toBe(true);
      expect(golfer.spent).toBe(golfer.courseId === "north" ? 120 : 55);
    }
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "2x", selectedGolferId: null }));
    expect(restored?.state.golfers.map((golfer) => [golfer.courseId, golfer.holeIds])).toEqual(live.golfers.map((golfer) => [golfer.courseId, golfer.holeIds]));
  }, 20_000);

  it("reconciles course-level revenue/cost/profit and records by stable IDs", () => {
    const course = multiCourse();
    const result = commitDay({
      course,
      world: DEFAULT_WORLD,
      revenue: 1_750,
      greenFees: 1_750,
      reactions: { rounds: 20, avgSatisfaction: 80, promoters: 10, detractors: 2, willReturnRate: .8 },
      perCourse: {
        north: { courseName: "North Course", arrivals: 10, roundsStarted: 10, roundsFinished: 10, greenFees: 1_200, satisfactionSum: 850, promoters: 6, detractors: 1, willReturnCount: 9 },
        south: { courseName: "South Course", arrivals: 10, roundsStarted: 10, roundsFinished: 10, greenFees: 550, satisfactionSum: 750, promoters: 4, detractors: 1, willReturnCount: 7 },
      },
    }).result;
    const report = { visitors: 20, revenue: result.revenue, costs: result.costs, profit: result.profit, avgSatisfaction: 80, reputationDelta: 0, visitorNoise: 0, perCourse: result.perCourse };
    expect(perCourseTotalsReconcile(report)).toBe(true);
    expect(result.perCourse?.map((row) => row.revenue)).toEqual([1200, 550]);

    const captured = recordCompletedRound(emptyCourseRecords(36), { golferId: 1, golferName: "Ada", archetype: "pro", score: 70, scoreToPar: -2, holePar: [4, 4], holeStrokes: [1, 3], mood: 1, courseId: "north", courseName: "North Course", holeIds: ["north-8", "north-2"] }, 4);
    expect(captured.records.byCourse?.north.holes["north-8"].rounds).toBe(1);
    expect(captured.records.aces[0]).toMatchObject({ courseId: "north", holeId: "north-8" });
  });

  it("produces one weekly operating report whose course rows reconcile", () => {
    const output = tickWeek(compactLiveCourse(), DEFAULT_WORLD, 2600);
    expect(output.result.perCourse?.map((row) => row.courseId)).toEqual(["north", "south"]);
    expect(perCourseTotalsReconcile(output.result)).toBe(true);
    expect(output.result.perCourse?.[0].revenue).not.toBe(output.result.perCourse?.[1].revenue);
  });

  it("books tournaments onto an eligible published 18-hole host only", () => {
    const course = multiCourse();
    const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 80, runSeed: 26 };
    const north = createTournamentEvent({ course, world, tier: "local", currentDay: 0, daysAhead: 2, courseId: "north" });
    expect(north.ok).toBe(true);
    if (north.ok) expect(north.event).toMatchObject({ courseId: "north", courseName: "North Course" });
    const south = createTournamentEvent({ course, world, tier: "local", currentDay: 0, daysAhead: 2, courseId: "south" });
    expect(south).toEqual({ ok: false, reason: "Tournament hosts must be an open, published 18-hole course." });
  }, 20_000);
});
