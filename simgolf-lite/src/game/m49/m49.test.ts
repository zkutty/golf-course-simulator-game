import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { buildM49DemandPlan } from "./demand";
import { m49CourseHistory, m49ReputationDelta, recordM49Observations } from "./history";
import { launchM49Marketing, strategicIdentity } from "./identity";
import { buildM49CourseReport } from "./report";
import type { M49ObservedRound } from "./types";

function fixtureCourse(hazard = false): Course {
  const width = 64;
  const height = 28;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  for (let y = 12; y <= 16; y++) for (let x = 55; x < 59; x++) tiles[y * width + x] = "green";
  if (hazard) for (let y = 0; y < height; y++) for (let x = 28; x <= 34; x++) tiles[y * width + x] = "water";
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `m49-hole-${index + 1}`,
    tee: { x: 5, y: 10 + index },
    green: { x: 56, y: 12 + Math.min(index, 4) },
    parMode: "MANUAL" as const,
    parManual: 4 as const,
    name: `M49 hole ${index + 1}`,
  }));
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    layouts: [{ id: "m49-course", name: "M49 test", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "m49-course",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "M49 test",
    baseGreenFee: 65,
    condition: .85,
    theme: "parkland",
  };
}

function observation(overrides: Partial<M49ObservedRound> = {}): M49ObservedRound {
  return {
    version: 1,
    id: "m49-observation",
    courseId: "m49-course",
    segment: "casual",
    completed: true,
    holesPlayed: 9,
    holesTotal: 9,
    expectedScore: 36,
    actualScore: 35,
    satisfaction: 88,
    condition: .85,
    greenFee: 65,
    strategicFit: .78,
    valueReceived: .82,
    willingnessToPay: 74,
    priceElasticity: 1.1,
    returnIntent: true,
    recommend: true,
    churnRisk: .1,
    paceDelayMinutes: 2,
    hospitalityDelayMinutes: 0,
    holeEvidence: [],
    causes: [],
    ...overrides,
  };
}

describe("M49 segment economics", () => {
  it("exposes predicted segment fit and different price elasticity before play evidence exists", () => {
    const plan = buildM49DemandPlan(fixtureCourse(), DEFAULT_WORLD);
    expect(Object.keys(plan.segments)).toHaveLength(6);
    expect(plan.segments.casual.evidenceLabel).toBe("predicted");
    expect(plan.segments.casual.priceElasticity).toBeGreaterThan(plan.segments.pro.priceElasticity);
    expect(plan.totalIndex).toBeGreaterThan(0);
  });

  it("moves the affected cohort when a shared hole becomes a forced hazard", () => {
    const open = buildM49DemandPlan(fixtureCourse(), DEFAULT_WORLD);
    const hazard = buildM49DemandPlan(fixtureCourse(true), DEFAULT_WORLD);
    expect(hazard.segments.casual.bookingAppeal).toBeLessThan(open.segments.casual.bookingAppeal);
    expect(hazard.segments.casual.willingnessToPay).toBeLessThanOrEqual(open.segments.casual.willingnessToPay);
  });

  it("learns from observed rounds but cannot create reputation from no play", () => {
    const unchanged = recordM49Observations(DEFAULT_WORLD, [], DEFAULT_WORLD.week);
    expect(unchanged).toBe(DEFAULT_WORLD);
    expect(m49ReputationDelta([])).toEqual({ delta: 0, observedRounds: 0 });
    expect(m49ReputationDelta([observation({ completed: false, holesPlayed: 0, satisfaction: 20, returnIntent: false, recommend: false })])).toEqual({ delta: 0, observedRounds: 0 });

    const nextWorld = recordM49Observations(DEFAULT_WORLD, [observation()], DEFAULT_WORLD.week);
    const history = m49CourseHistory(nextWorld, "m49-course");
    expect(history?.completedRounds).toBe(1);
    expect(history?.segments.casual?.observedRounds).toBe(1);
    expect(m49ReputationDelta([observation()]).delta).toBeGreaterThan(0);
  });

  it("keeps niche identity and unsupported marketing costed and evidence-bound", () => {
    const course = fixtureCourse();
    const identity = strategicIdentity(course, DEFAULT_WORLD);
    expect(identity.courseId).toBe("m49-course");
    expect(identity.tags.length).toBeGreaterThan(0);
    expect(identity.amenities.tourist.score).toBe(0);

    const launch = launchM49Marketing({ course, world: { ...DEFAULT_WORLD, cash: 10_000, marketingLevel: 5 }, segment: "casual", strength: "championship" });
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(launch.world.cash).toBeLessThan(10_000);
    expect(launch.promise.credibility).toBeLessThan(.7);
    const disappointed = recordM49Observations(launch.world, [observation({ valueReceived: .25, satisfaction: 32, returnIntent: false, recommend: false })], DEFAULT_WORLD.week);
    expect(disappointed.m49?.marketingPromises?.[0].disappointedRounds).toBe(1);
    expect(buildM49DemandPlan(course, launch.world).segments.casual.causes).toContain("marketing:promise-disappointment");
  });

  it("reports demand, observed causes, maintenance pressure, and a balanced ledger", () => {
    const course = fixtureCourse();
    const world = recordM49Observations(DEFAULT_WORLD, [observation({
      holeEvidence: [{
        holeId: "m49-hole-1",
        expectedScore: 4,
        actualScore: 8,
        satisfaction: 38,
        outcome: "frustrated",
        causes: ["difficulty:unfair", "pace:delay"],
      }],
      causes: ["difficulty:unfair", "pace:delay"],
    })], DEFAULT_WORLD.week);
    const report = buildM49CourseReport({ course, world, generatedAtWeek: 7 });
    expect(report.generatedAtWeek).toBe(7);
    expect(report.demand.segments.casual.evidenceLabel).toBe("mixed");
    expect(report.observedRounds).toBe(1);
    expect(report.reconciliation.ledgerBalanced).toBe(true);
    expect(report.reconciliation.authoritativeCondition).toBe(course.condition);
    expect(report.topCauses.map((cause) => cause.cause)).toContain("difficulty:unfair");
    expect(new Set(report.alerts.map((alert) => alert.id)).size).toBe(report.alerts.length);
  });
});
