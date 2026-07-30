import { describe, expect, it } from "vitest";
import type { Course, Obstacle, Point, Terrain } from "../models/types";
import { calculateShotEffects, SHOT_CLUBS } from "../rules/shotEffects";
import type { GolferCapabilities } from "./m47Types";
import type { Personality } from "./personality";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import {
  followUpIntent,
  generateRecoveryCandidates,
  generateStrategicHolePlan,
} from "./strategicOptions";

const personality: Personality = {
  skill: .7,
  consistency: .7,
  patience: .5,
  spendPropensity: .5,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

function capabilities(over: Partial<GolferCapabilities> = {}): GolferCapabilities {
  return {
    version: 1,
    seed: 551,
    power: 72,
    accuracy: 72,
    irons: 72,
    shortGame: 68,
    recovery: 65,
    consistency: 72,
    riskTolerance: .5,
    challengeSeeking: .5,
    sceneryAffinity: .5,
    valueSensitivity: .5,
    riskStyle: "balanced",
    strengths: ["irons", "recovery"],
    weaknesses: ["power", "shortGame"],
    ...over,
  };
}

function recoveryCourse(obstacles: Obstacle[] = [{ type: "tree", x: 15, y: 12 }]): Course {
  const width = 52;
  const height = 25;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
  const tee = { x: 3, y: 12 };
  const green = { x: 47, y: 12 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = green.y - 1; y <= green.y + 1; y++) {
    for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "green";
  }
  return {
    name: "ZK-551 recovery",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ id: "zk-551-hole", tee, green, parMode: "MANUAL", parManual: 4 }],
    obstacles,
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 60,
    condition: .85,
  };
}

function fact(intent: ReturnType<typeof generateRecoveryCandidates>[number], code: string) {
  return intent.facts.find((item) => item.code === code)?.detail ?? "";
}

function shape(intent: ReturnType<typeof generateRecoveryCandidates>[number]) {
  return fact(intent, "context").match(/shape:(around|under|over)/)?.[1];
}

function route(intent: ReturnType<typeof generateRecoveryCandidates>[number]) {
  return fact(intent, "context").match(/recovery:(safe|advance|hero)/)?.[1];
}

describe("ZK-551 M50 recovery strategy", () => {
  it("generates legal around, under, and over candidates with expected-cost evidence", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12.5 }]);
    const from = { x: 8, y: 12 };
    const candidates = generateRecoveryCandidates({
      course,
      hole: course.holes[0],
      from,
      lie: "deep_rough",
      capabilities: capabilities(),
      personality,
      shotNumber: 2,
    });

    expect(new Set(candidates.map(shape))).toEqual(new Set(["around", "under", "over"]));
    expect(new Set(candidates.map(route))).toEqual(new Set(["safe", "advance", "hero"]));
    expect(candidates.every((candidate) => {
      const club = SHOT_CLUBS.find((item) => item.label === candidate.club);
      return club && calculateShotEffects({
        clubId: club.id,
        lie: "deep_rough",
        recoverySkill: capabilities().recovery,
        technique: candidate.technique,
        flightProfile: candidate.flightProfile ?? "standard",
      }).ok;
    })).toBe(true);
    expect(candidates.find((candidate) => shape(candidate) === "under")).toMatchObject({
      technique: "punch",
      flightProfile: "low",
    });
    expect(candidates.filter((candidate) => shape(candidate) === "over").every((candidate) => candidate.flightProfile === "high")).toBe(true);
    expect(candidates.every((candidate) => candidate.facts.some((item) => item.code === "outcome" && item.detail.startsWith("expected-cost:")))).toBe(true);
  });

  it("prices a blocked direct recovery above a route with obstacle clearance", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12 }]);
    const candidates = generateRecoveryCandidates({
      course,
      hole: course.holes[0],
      from: { x: 8, y: 12 },
      lie: "rough",
      capabilities: capabilities({ accuracy: 78, consistency: 80 }),
      personality,
    });
    const around = candidates.find((candidate) => route(candidate) === "safe" && shape(candidate) === "around");
    const under = candidates.find((candidate) => shape(candidate) === "under");

    expect(around).toBeDefined();
    expect(under).toBeDefined();
    expect(fact(around!, "outcome")).toContain("relationship:around");
    expect(fact(under!, "outcome")).toContain("relationship:through");
    expect(under!.hazardRisk).toBeGreaterThan(around!.hazardRisk);
    expect(under!.expectedStrokes).toBeGreaterThan(around!.expectedStrokes);
  });

  it("uses the first obstacle on the route while preserving deterministic ordering", () => {
    const course = recoveryCourse([
      { type: "tree", x: 15, y: 12 },
      { type: "rock", x: 23, y: 12 },
    ]);
    const candidates = generateRecoveryCandidates({
      course,
      hole: course.holes[0],
      from: { x: 8, y: 12 },
      lie: "rough",
      capabilities: capabilities(),
      personality,
    });
    const around = candidates.find((candidate) => route(candidate) === "safe" && shape(candidate) === "around");
    expect(around?.target.x).toBeLessThan(27);
  });

  it("makes conservative recovery and skilled aggressive advancement recognizable", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12 }]);
    const from = { x: 8, y: 12 };
    const conservative = followUpIntent({
      course,
      hole: course.holes[0],
      from,
      lie: "deep_rough",
      capabilities: capabilities({
        seed: 17,
        power: 48,
        accuracy: 48,
        recovery: 28,
        consistency: 45,
        riskTolerance: .15,
        challengeSeeking: .1,
        riskStyle: "conservative",
      }),
      personality: { ...personality, prefs: { ...personality.prefs, difficulty: -.8 } },
      shotNumber: 2,
    });
    const aggressive = followUpIntent({
      course,
      hole: course.holes[0],
      from,
      lie: "deep_rough",
      capabilities: capabilities({
        seed: 18,
        power: 92,
        accuracy: 91,
        recovery: 94,
        consistency: 93,
        riskTolerance: .92,
        challengeSeeking: .95,
        riskStyle: "aggressive",
      }),
      personality: { ...personality, prefs: { ...personality.prefs, difficulty: .9 } },
      shotNumber: 2,
    });

    expect(route(conservative)).toBe("safe");
    expect(["advance", "hero"]).toContain(route(aggressive));
    expect(Math.hypot(aggressive.target.x - from.x, aggressive.target.y - from.y))
      .toBeGreaterThan(Math.hypot(conservative.target.x - from.x, conservative.target.y - from.y));
  });

  it("turns recovery, accuracy, and consistency into lower deterministic option cost", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12.5 }]);
    const args = {
      course,
      hole: course.holes[0],
      from: { x: 8, y: 12 },
      lie: "deep_rough",
      personality,
      shotNumber: 2,
    };
    const developing = generateRecoveryCandidates({
      ...args,
      capabilities: capabilities({ seed: 77, recovery: 24, accuracy: 35, consistency: 32 }),
    }).find((candidate) => route(candidate) === "safe")!;
    const accomplished = generateRecoveryCandidates({
      ...args,
      capabilities: capabilities({ seed: 77, recovery: 94, accuracy: 92, consistency: 95 }),
    }).find((candidate) => route(candidate) === "safe")!;

    expect(accomplished.hazardRisk).toBeLessThan(developing.hazardRisk);
    expect(accomplished.variance).toBeLessThan(developing.variance);
    expect(accomplished.expectedStrokes).toBeLessThan(developing.expectedStrokes);
  });

  it("carries the chosen flight and technique through live resolution with obstacle, relief, and next-shot facts", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12.5 }]);
    const from = { x: 8, y: 12 };
    const golfer = capabilities({ recovery: 88, accuracy: 84, consistency: 86 });
    const intent = followUpIntent({
      course,
      hole: course.holes[0],
      from,
      lie: "rough",
      capabilities: golfer,
      personality,
      shotNumber: 2,
    });
    const outcome = resolveLiveShot({
      snapshot: liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" }),
      capabilities: golfer,
      holeId: "zk-551-hole",
      shotNumber: 2,
      from,
      lie: "rough",
      intent,
      seed: 551,
    });

    expect(outcome.technique).toBe(intent.technique);
    expect(outcome.flightProfile).toBe(intent.flightProfile);
    expect(intent.facts.some((item) => item.code === "outcome" && item.detail.includes("collision-risk:"))).toBe(true);
    expect(intent.facts.some((item) => item.code === "outcome" && item.detail.includes("relief:"))).toBe(true);
    expect(intent.facts.some((item) => item.code === "next-shot" && item.detail.includes("quality:"))).toBe(true);
  });

  it("is byte-stable across repeated recovery candidate and plan generation", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12.5 }]);
    const golfer = capabilities({ seed: 9001, recovery: 77 });
    const args = {
      course,
      hole: course.holes[0],
      from: { x: 8, y: 12 } satisfies Point,
      lie: "rough",
      capabilities: golfer,
      personality,
      shotNumber: 2,
    };
    expect(generateRecoveryCandidates(args)).toEqual(generateRecoveryCandidates(args));

    const firstPlan = generateStrategicHolePlan({ course, hole: course.holes[0], par: 4, capabilities: golfer, personality });
    const secondPlan = generateStrategicHolePlan({ course, hole: course.holes[0], par: 4, capabilities: golfer, personality });
    expect(firstPlan).toEqual(secondPlan);
  });

  it("preserves the legacy follow-up contract without M50 recovery context", () => {
    const course = recoveryCourse([]);
    const from = { x: 18, y: 12 };
    const intent = followUpIntent({
      course,
      hole: course.holes[0],
      from,
      lie: "fairway",
      capabilities: capabilities(),
      personality,
      shotNumber: 2,
    });

    expect(intent.id).toBe("zk-551-hole-follow-2");
    expect(intent.kind).toBe("positional");
    expect(intent.technique).toBe("normal");
    expect(intent.flightProfile).toBeUndefined();
  });

  it("only plans proactive ordinary-lie recovery after an explicit obstacle collision", () => {
    const course = recoveryCourse([{ type: "tree", x: 10, y: 12 }]);
    const args = {
      course,
      hole: course.holes[0],
      from: { x: 8, y: 12 },
      lie: "fairway",
      capabilities: capabilities(),
      personality,
      shotNumber: 2,
    } as const;
    const ordinary = followUpIntent(args);
    const obstacleRecovery = followUpIntent({ ...args, obstacleRecoveryContext: true });

    expect(ordinary.id).toBe("zk-551-hole-follow-2");
    expect(ordinary.flightProfile).toBeUndefined();
    expect(obstacleRecovery.id).not.toBe(ordinary.id);
    expect(obstacleRecovery.flightProfile).toBeDefined();
    expect(obstacleRecovery.facts.some((item) => item.code === "context" && item.detail.includes("recovery:"))).toBe(true);
  });

  it("does not sample recovery alternatives for a normal tee route past a distant obstacle", () => {
    const course = recoveryCourse([{ type: "tree", x: 15, y: 12 }]);
    expect(generateRecoveryCandidates({
      course,
      hole: course.holes[0],
      from: course.holes[0].tee!,
      lie: "tee",
      capabilities: capabilities(),
      personality,
    })).toEqual([]);
  });
});
