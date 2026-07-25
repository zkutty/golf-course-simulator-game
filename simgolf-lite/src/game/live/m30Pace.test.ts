import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { normalizeCourseLayouts, updateLayout } from "../models/courseLayouts";
import { createM26MultiCourseReferenceCourse, createPlayerProReferenceCourse } from "../testing/referenceCourse";
import { normalizeLoadedSaveResult } from "../../utils/save";
import { commitDay } from "./commitDay";
import { emptyPaceDayMetrics, ensureCoursePaceMetrics } from "./pace";
import {
  diagnosePaceBottlenecks,
  paceIdentity,
  paceRepeatIntentModifier,
  paceReport,
  recordPaceDay,
} from "./paceHistory";
import { createLiveState, stepLive } from "./simulation";
import { planTournamentDay } from "../tournaments/tournaments";
import type { TournamentEvent } from "../tournaments/types";

function paceDay(courseIds: string[], variance: number, wait: number) {
  const pace = emptyPaceDayMetrics(courseIds);
  for (const courseId of courseIds) {
    const metrics = ensureCoursePaceMetrics(pace, courseId);
    metrics.groupsStarted = 4;
    metrics.groupsFinished = 4;
    metrics.roundsCompleted = 12;
    metrics.roundDurations = [105 + variance, 110 + variance, 115 + variance, 120 + variance];
    metrics.totalWaitMinutes = wait * 12;
    metrics.greenFeeRevenue = courseId === "north" ? 1_440 : 660;
    metrics.beverageRevenue = courseId === "north" ? 240 : 60;
    metrics.occupiedTeeMinutes = 480;
    metrics.satisfaction = 12 * (variance > 0 ? 62 : 84);
    metrics.cohorts.skilled_impatient = {
      samples: 5, durationMinutes: 5 * (105 + variance), timeParVarianceMinutes: 5 * variance,
      waitMinutes: 5 * wait, pickups: 0, abandonments: 0, satisfaction: 5 * (variance > 0 ? 58 : 88),
    };
    metrics.cohorts.novice_social = {
      samples: 5, durationMinutes: 5 * (120 + variance / 2), timeParVarianceMinutes: 5 * (variance / 2),
      waitMinutes: 5 * wait, pickups: 0, abandonments: 0, satisfaction: 5 * 78,
    };
    metrics.cohorts.general = {
      samples: 2, durationMinutes: 2 * (112 + variance), timeParVarianceMinutes: 2 * variance,
      waitMinutes: 2 * wait, pickups: 0, abandonments: 0, satisfaction: 2 * 75,
    };
  }
  return pace;
}

describe("M30 rolling pace identity and reporting", () => {
  it("changes gradually, remains deterministic, and preserves cohort perceptions", () => {
    const course = normalizeCourseLayouts(createPlayerProReferenceCourse());
    const courseId = course.activeCourseId!;
    const oneDay = recordPaceDay(DEFAULT_WORLD, course, 0, paceDay([courseId], 55, 24));
    const first = paceIdentity(oneDay, courseId);
    expect(first.score).toBeGreaterThan(0.35);
    expect(first.score).toBeLessThan(0.55);

    let sustained = DEFAULT_WORLD;
    for (let day = 0; day < 14; day++) {
      sustained = recordPaceDay({ ...sustained, week: 1 + Math.floor(day / 7) }, course, day % 7, paceDay([courseId], 55, 24));
    }
    const identity = paceIdentity(sustained, courseId);
    expect(identity.score).toBeLessThan(first.score);
    expect(identity.cohorts.skilled_impatient).toBeLessThan(identity.cohorts.novice_social);
    expect(paceIdentity(sustained, courseId)).toEqual(identity);
    expect(sustained.paceOperations?.courses[courseId].samples).toHaveLength(14);
    expect(paceRepeatIntentModifier(identity.score, identity.score)).toBeGreaterThan(0);
    expect(paceRepeatIntentModifier(identity.score, 1)).toBeLessThan(
      paceRepeatIntentModifier(identity.score, identity.score),
    );
    const visit = createLiveState(course, sustained, 0);
    expect(visit.arrivals.every((arrival) => arrival.paceIdentityAtVisit === identity.score)).toBe(true);
  });

  it("keeps course histories and revenue-per-tee-hour isolated", () => {
    const course = normalizeCourseLayouts(createM26MultiCourseReferenceCourse());
    let world = DEFAULT_WORLD;
    for (let day = 0; day < 8; day++) {
      const pace = paceDay(["north", "south"], day % 2 ? 8 : -5, day);
      ensureCoursePaceMetrics(pace, "south").greenFeeRevenue = 220;
      ensureCoursePaceMetrics(pace, "south").beverageRevenue = 20;
      world = recordPaceDay({ ...world, week: 1 + Math.floor(day / 7) }, course, day % 7, pace);
    }
    const north = paceReport(world, course, "north", 7);
    const south = paceReport(world, course, "south", 7);
    expect(north.operatingDays).toBe(7);
    expect(north.revenuePerTeeHour).toBeGreaterThan(south.revenuePerTeeHour);
    expect(world.paceOperations?.courses.north.samples.every((sample) => sample.courseId === "north")).toBe(true);
    expect(world.paceOperations?.courses.south.samples.every((sample) => sample.courseId === "south")).toBe(true);

    const loaded = normalizeLoadedSaveResult({ schemaVersion: 18, savedAt: 1, course, world });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.payload.world.paceOperations).toEqual(world.paceOperations);
  });

  it("ranks measured local peaks without reporting every upstream hole", () => {
    const course = normalizeCourseLayouts(createM26MultiCourseReferenceCourse());
    const pace = paceDay(["north"], 10, 5);
    const north = ensureCoursePaceMetrics(pace, "north");
    north.holes = {
      "north-1": { holeId: "north-1", queueMinutes: 42, occupancyMinutes: 80, recoveryDelayMinutes: 0, visits: 6 },
      "north-2": { holeId: "north-2", queueMinutes: 12, occupancyMinutes: 65, recoveryDelayMinutes: 0, visits: 6 },
      "north-3": { holeId: "north-3", queueMinutes: 66, occupancyMinutes: 90, recoveryDelayMinutes: 12, visits: 6 },
      "north-4": { holeId: "north-4", queueMinutes: 48, occupancyMinutes: 85, recoveryDelayMinutes: 0, visits: 6 },
    };
    const world = recordPaceDay(DEFAULT_WORLD, course, 0, pace);
    const findings = diagnosePaceBottlenecks(world, course, "north", undefined, 0);
    expect(findings[0]).toMatchObject({ holeId: "north-3", severity: "severe" });
    expect(findings.map((finding) => finding.holeId)).not.toContain("north-2");
    expect(findings.every((finding) => finding.reason && finding.recommendation && finding.tradeoff)).toBe(true);
  });
});

describe("M30 daylight, compensation, tournaments, and certification budgets", () => {
  it("settles strict-sunset refunds and overtime exactly through daily cash", () => {
    const base = normalizeCourseLayouts(createPlayerProReferenceCourse());
    const courseId = base.activeCourseId!;
    const course = updateLayout(base, courseId, {
      greenFee: 80,
      operations: {
        ...base.layouts![0].operations!,
        lastTeeMinute: 600,
        daylightPolicy: "strict_sunset",
        compensationPolicy: "refund",
      },
    });
    const world = { ...DEFAULT_WORLD, staffLevel: 4 };
    const live = createLiveState(course, world, 0);
    live.arrivals = [{ atMinute: 20, archetype: "casual", courseId, groupId: "late" }];
    live.groups = [{ id: "late", courseId, bookedAt: 20, startedAt: null, golferIds: [], waitMinutes: 0, blocked: false, interventions: 0, pickups: 0, finishedAt: null }];
    live.nextArrivalIdx = 0;
    live.dayMinute = 19;
    stepLive(live, course, 1);
    expect(live.golfers).toHaveLength(1);
    live.golfers[0].currentHole = 0;
    live.golfers[0].currentHoleId = course.layouts![0].publishedHoleIds[0];
    live.golfers[0].segments = [{ kind: "pause", from: live.golfers[0].pos, to: live.golfers[0].pos, holeIndex: 0, holeId: live.golfers[0].currentHoleId, dur: 1_000 }];
    live.golfers[0].segIndex = 0;
    live.dayMinute = 839;
    live.nextArrivalIdx = live.arrivals.length;
    stepLive(live, course, 2);

    const metrics = live.pace!.perCourse[courseId];
    expect(metrics.roundsIncomplete).toBe(1);
    expect(metrics.refunds).toBe(course.layouts![0].greenFee);
    expect(metrics.overtimeCost).toBeGreaterThan(0);
    expect(live.dayOver).toBe(true);

    const reactions = { rounds: 1, avgSatisfaction: 30, promoters: 0, detractors: 1, willReturnRate: 0 };
    const withPace = commitDay({ course, world, revenue: 0, reactions, dayIndex: 0, pace: live.pace, perCourse: live.perCourse });
    const withoutPace = commitDay({ course, world, revenue: 0, reactions, dayIndex: 0, pace: emptyPaceDayMetrics([courseId]), perCourse: live.perCourse });
    expect(withPace.result.costs - withoutPace.result.costs).toBeCloseTo(metrics.refunds + metrics.overtimeCost, 6);
    expect(withPace.result.revenueBreakdown.paceCompensation).toBe(metrics.refunds);
    expect(withPace.world.cash).toBeCloseTo(withoutPace.world.cash - metrics.refunds - metrics.overtimeCost, 6);
  });

  it("books tournament competitors into deterministic groups without changing entrants", () => {
    const event = {
      id: "event", courseId: "north",
      field: Array.from({ length: 10 }, (_, index) => ({ id: `entrant-${index}`, name: `Player ${index}`, archetype: "pro", skill: 0.8 })),
    } as unknown as TournamentEvent;
    const first = planTournamentDay(event, 20, 10, 3);
    const second = planTournamentDay(event, 20, 10, 3);
    expect(first).toEqual(second);
    expect(new Set(first.map((arrival) => arrival.groupId)).size).toBe(4);
    expect(first.filter((arrival) => arrival.groupId === "event-group-1")).toHaveLength(3);
    expect(first.map((arrival) => arrival.tournament?.entrantId)).toEqual(event.field.map((entrant) => entrant.id));
  });

  it("keeps 28-day aggregation and bottleneck selectors inside the M30 budget", () => {
    const course = normalizeCourseLayouts(createM26MultiCourseReferenceCourse());
    let world = DEFAULT_WORLD;
    for (let day = 0; day < 28; day++) {
      const pace = paceDay(["north", "south"], day % 8, day % 6);
      ensureCoursePaceMetrics(pace, "north").holes["north-4"] = { holeId: "north-4", queueMinutes: day + 2, occupancyMinutes: 60, recoveryDelayMinutes: 5, visits: 4 };
      world = recordPaceDay({ ...world, week: 1 + Math.floor(day / 7) }, course, day % 7, pace);
    }
    const started = performance.now();
    for (let iteration = 0; iteration < 1_000; iteration++) {
      paceReport(world, course, iteration % 2 ? "north" : "south", 28);
      diagnosePaceBottlenecks(world, course, "north", undefined, 1);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
