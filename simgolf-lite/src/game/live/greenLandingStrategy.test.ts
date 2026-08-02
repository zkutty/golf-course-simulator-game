import { describe, expect, it } from "vitest";
import type { Course, PinRotation, Point, Terrain } from "../models/types";
import { courseForCourseSetup } from "../models/courseSetup";
import { createFlatGreenSurfaceV1, createGreenProgram, createHealthyGreenLocalState } from "../greens/greenSurface";
import type { GolferCapabilities } from "./m47Types";
import type { Personality } from "./personality";
import { liveCourseSnapshot } from "./livePhysics";
import { GREEN_LANDING_ZONE_LIMIT, planGreenLandingZones } from "./greenLandingStrategy";
import { generateStrategicHolePlan } from "./strategicOptions";

const personality: Personality = {
  skill: .72,
  consistency: .72,
  patience: .5,
  spendPropensity: .5,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

function capabilities(over: Partial<GolferCapabilities> = {}): GolferCapabilities {
  return {
    version: 1,
    seed: 641,
    power: 70,
    accuracy: 70,
    irons: 70,
    shortGame: 70,
    recovery: 65,
    consistency: 72,
    riskTolerance: .5,
    challengeSeeking: .5,
    sceneryAffinity: .5,
    valueSensitivity: .5,
    riskStyle: "balanced",
    strengths: ["irons", "accuracy"],
    weaknesses: ["power", "shortGame"],
    ...over,
  };
}

function strategicGreenCourse(pinRotation: PinRotation = "A", speed: "receptive" | "championship" = "receptive"): Course {
  const width = 34;
  const height = 24;
  const tiles: Terrain[] = new Array(width * height).fill("fairway");
  const elevations = new Array(width * height).fill(0);
  for (let y = 7; y <= 16; y++) for (let x = 21; x <= 29; x++) {
    tiles[y * width + x] = "green";
    elevations[y * width + x] = x >= 26 ? 1 : y >= 12 ? .35 : 0;
  }
  for (let y = 5; y <= 10; y++) for (let x = 29; x <= 32; x++) tiles[y * width + x] = "water";
  for (let y = 15; y <= 19; y++) for (let x = 19; x <= 24; x++) tiles[y * width + x] = "sand";
  const tee = { x: 5, y: 12 };
  const hole = {
    id: "zk-641-green",
    tee,
    green: { x: 23, y: 9 },
    teeBoxes: { member: tee },
    pinPositions: {
      A: { x: 23, y: 9 },
      B: { x: 28, y: 13 },
      C: { x: 25, y: 15 },
    },
    parMode: "MANUAL" as const,
    parManual: 3 as const,
  };
  const course: Course = {
    name: "ZK-641 strategic green",
    width,
    height,
    tiles,
    elevations,
    holes: [hole],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 60,
    condition: .9,
    activePinRotation: pinRotation,
    greenSurface: createFlatGreenSurfaceV1(),
    greenProgram: createGreenProgram(speed),
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return courseForCourseSetup(course, "member", pinRotation);
}

function role(plan: ReturnType<typeof generateStrategicHolePlan>): string {
  return plan.chosen.facts.find((fact) => fact.code === "context")?.detail.match(/green-zone:([^ ]+)/)?.[1] ?? "none";
}

function targetKey(point: Point): string {
  return `${point.x},${point.y}`;
}

describe("ZK-641 strategic green landing zones", () => {
  it("makes canonical capability and personality cohorts choose meaningfully different retained zones", () => {
    const course = strategicGreenCourse();
    const hole = course.holes[0];
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
    const cohorts = [
      capabilities({ seed: 1, power: 96, accuracy: 58, irons: 62, shortGame: 48, riskTolerance: .72, challengeSeeking: .82, riskStyle: "aggressive", strengths: ["power", "recovery"] }),
      capabilities({ seed: 2, power: 58, accuracy: 96, irons: 74, shortGame: 61, riskTolerance: .44, strengths: ["accuracy", "irons"] }),
      capabilities({ seed: 3, power: 64, accuracy: 78, irons: 96, shortGame: 58, riskTolerance: .48, strengths: ["irons", "accuracy"] }),
      capabilities({ seed: 4, power: 55, accuracy: 67, irons: 64, shortGame: 97, riskTolerance: .53, strengths: ["shortGame", "recovery"] }),
      capabilities({ seed: 5, power: 54, accuracy: 78, irons: 68, shortGame: 72, riskTolerance: .16, challengeSeeking: .12, riskStyle: "conservative" }),
      capabilities({ seed: 6, power: 90, accuracy: 84, irons: 88, shortGame: 76, riskTolerance: .94, challengeSeeking: .96, riskStyle: "aggressive" }),
      capabilities({ seed: 7, power: 38, accuracy: 42, irons: 39, shortGame: 45, consistency: 44, riskTolerance: .28, riskStyle: "conservative" }),
    ];
    const plans = cohorts.map((golfer, index) => generateStrategicHolePlan({
      course,
      hole,
      par: 3,
      capabilities: golfer,
      personality: index === 4 || index === 6 ? { ...personality, prefs: { ...personality.prefs, difficulty: -.8 } } : index === 5 ? { ...personality, prefs: { ...personality.prefs, difficulty: .9 } } : personality,
      snapshot,
    }));

    expect(plans.every((plan) => plan.chosen.kind === "approach")).toBe(true);
    expect(new Set(plans.map((plan) => targetKey(plan.chosen.target))).size).toBeGreaterThanOrEqual(3);
    expect(new Set(plans.map(role)).size).toBeGreaterThanOrEqual(3);
    expect(targetKey(plans[4].chosen.target)).not.toBe(targetKey(plans[5].chosen.target));
    expect(plans[3].chosen.technique === "punch" || role(plans[3]) === "uphill").toBe(true);
    expect(plans.every((plan) => plan.rejected.length === 5)).toBe(true);
    expect(plans.every((plan) => plan.rejected.every((item) => item.intentId && item.target && item.score != null && item.facts.some((fact) => fact.detail.includes("expected-putts:"))))).toBe(true);
  });

  it("changes only the active pin or realized speed and retains the reason", () => {
    const golfer = capabilities({ accuracy: 83, irons: 86, shortGame: 79, riskTolerance: .48 });
    const slowA = strategicGreenCourse("A", "receptive");
    const slowB = strategicGreenCourse("B", "receptive");
    const fastA = strategicGreenCourse("A", "championship");
    const plan = (course: Course, rotation: PinRotation) => generateStrategicHolePlan({
      course,
      hole: course.holes[0],
      par: 3,
      capabilities: golfer,
      personality,
      snapshot: liveCourseSnapshot({ course, teeSet: "member", pinRotation: rotation }),
    });
    const a = plan(slowA, "A");
    const b = plan(slowB, "B");
    const fast = plan(fastA, "A");

    expect(targetKey(a.chosen.target)).not.toBe(targetKey(b.chosen.target));
    expect(targetKey(a.chosen.target)).not.toBe(targetKey(fast.chosen.target));
    expect(a.chosen.facts.find((fact) => fact.code === "context")?.detail).toContain("pin:23.00,9.00");
    expect(b.chosen.facts.find((fact) => fact.code === "context")?.detail).toContain("pin:28.00,13.00");
    expect(a.chosen.facts.find((fact) => fact.code === "outcome")?.detail).not.toBe(fast.chosen.facts.find((fact) => fact.code === "outcome")?.detail);
  });

  it("avoids dominated short-sided and roll-off zones while retaining them for inspection", () => {
    const course = strategicGreenCourse("B", "championship");
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "B" });
    const candidates = planGreenLandingZones({
      course,
      hole: course.holes[0],
      from: course.holes[0].tee!,
      lie: "tee",
      capabilities: capabilities({ accuracy: 62, irons: 64, riskTolerance: .22, riskStyle: "conservative" }),
      personality: { ...personality, prefs: { ...personality.prefs, difficulty: -.8 } },
      snapshot,
    });
    const chosen = candidates[0];
    const dominated = candidates.filter((candidate) => candidate.rollOffRisk > 0 || candidate.shortSidedRisk > .4);

    expect(candidates.length).toBeLessThanOrEqual(GREEN_LANDING_ZONE_LIMIT);
    expect(dominated.length).toBeGreaterThan(0);
    expect(chosen.rollOffRisk).toBe(0);
    expect(chosen.shortSidedRisk).toBeLessThan(.4);
    expect(chosen.score).toBeLessThan(Math.max(...dominated.map((candidate) => candidate.score)));
  });

  it("is deterministic and bounded for 36 holes across 100 golfer cohorts", () => {
    const base = strategicGreenCourse();
    const course: Course = {
      ...base,
      holes: Array.from({ length: 36 }, (_, index) => ({ ...base.holes[0], id: `zk-641-${index + 1}` })),
    };
    course.greenLocalState = createHealthyGreenLocalState(course);
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
    const signature = () => {
      let hash = 2166136261;
      for (let golferIndex = 0; golferIndex < 100; golferIndex++) {
        const golfer = capabilities({ seed: golferIndex + 1, power: 40 + golferIndex % 57, accuracy: 42 + golferIndex % 55, irons: 44 + golferIndex % 53, shortGame: 46 + golferIndex % 51 });
        for (const hole of course.holes) {
          const candidates = planGreenLandingZones({ course, hole, from: hole.tee!, lie: "tee", capabilities: golfer, personality, snapshot });
          expect(candidates.length).toBeLessThanOrEqual(GREEN_LANDING_ZONE_LIMIT);
          const text = `${hole.id}:${candidates[0]?.id}:${candidates[0]?.score}`;
          for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
        }
      }
      return hash;
    };
    expect(signature()).toBe(signature());
  }, 20_000);
});
