import { describe, expect, it } from "vitest";
import { buildArchitectureReview, defaultArchitectureFilters } from "../architecture/review";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Point, World } from "../models/types";
import type { PlayerPlayableRound } from "../models/playerProTypes";
import {
  analyzeShotSlope,
  MAX_TOTAL_CURVE_BIAS_TILES,
  resolveShotCurve,
  type ShotCurveTechnique,
  type ShotHandedness,
} from "../models/shotSlope";
import {
  autoFinishPlayerRound,
  caddieRecommendation,
  commitPlayerShot,
  createDefaultPlayerPro,
  normalizePlayerPro,
  previewPlayableShot,
  startPlayableRound,
} from "../playerPro/playerPro";
import { settlePlayerRound } from "../playerPro/playerProSettlement";
import { recordPlayerRoundArchitecture } from "../livingClub/livingClub";
import { createPlayerProReferenceCourse } from "./referenceCourse";
import { createLiveState, stepLive } from "../live/simulation";
import { liveCourseSnapshot, previewLiveShot, resolveLiveShot } from "../live/livePhysics";
import { generateStrategicHolePlan } from "../live/strategicOptions";
import type { GolferCapabilities } from "../live/m47Types";
import type { Personality } from "../live/personality";
import { normalizeLoadedSaveResult } from "../../utils/save";

const M61_SEED = 61_636;
const TARGET_LINE_FROM = { x: 5, y: 7 } as const;
const TARGET_LINE_TO = { x: 25, y: 7 } as const;

const personality: Personality = {
  skill: 0.7,
  consistency: 0.76,
  patience: 0.55,
  spendPropensity: 0.5,
  prefs: { difficulty: 0, scenery: 0, price: 0 },
};

const capabilities: GolferCapabilities = {
  version: 1,
  seed: M61_SEED,
  power: 72,
  accuracy: 76,
  irons: 74,
  shortGame: 70,
  recovery: 72,
  consistency: 76,
  riskTolerance: 0.5,
  challengeSeeking: 0.5,
  sceneryAffinity: 0.5,
  valueSensitivity: 0.5,
  riskStyle: "balanced",
  strengths: ["accuracy", "irons"],
  weaknesses: ["power", "shortGame"],
};

function planeElevations(args: {
  width?: number;
  height?: number;
  along?: number;
  cross?: number;
} = {}): number[] {
  const width = args.width ?? 31;
  const height = args.height ?? 15;
  return Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return (x - TARGET_LINE_FROM.x) * (args.along ?? 0)
      + (y - TARGET_LINE_FROM.y) * (args.cross ?? 0);
  });
}

function slopeContext(args: {
  handedness: ShotHandedness;
  along?: number;
  cross?: number;
}) {
  return analyzeShotSlope({
    course: {
      width: 31,
      height: 15,
      elevations: planeElevations(args),
    },
    from: TARGET_LINE_FROM,
    to: TARGET_LINE_TO,
    yardsPerTile: 10,
    handedness: args.handedness,
  });
}

function caddieVariant(base: PlayerPlayableRound, rise: number): PlayerPlayableRound {
  const pin = base.course.holes[0].pin;
  const ball: Point = { x: pin.x - 20, y: pin.y };
  const elevations = base.course.elevations.slice();
  if (rise > 0) elevations[pin.y * base.course.width + pin.x] = rise;
  if (rise < 0) elevations[ball.y * base.course.width + ball.x] = -rise;
  return { ...base, ball, lie: "fairway", course: { ...base.course, elevations } };
}

function playerWorld(handedness: ShotHandedness = "right"): World {
  return {
    ...DEFAULT_WORLD,
    runSeed: M61_SEED,
    cash: 250_000,
    reputation: 80,
    playerPro: createDefaultPlayerPro({ seed: M61_SEED, name: "M61 Certifier", handedness }),
  };
}

function sidehillCourse(): Course {
  const course = createPlayerProReferenceCourse();
  const firstTee = course.holes[0].tee!;
  const firstGreen = course.holes[0].green!;
  const dx = firstGreen.x - firstTee.x;
  const dy = firstGreen.y - firstTee.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const crossX = -dy / length;
  const crossY = dx / length;
  return {
    ...course,
    elevations: Array.from({ length: course.width * course.height }, (_, index) => {
      const x = index % course.width;
      const y = Math.floor(index / course.width);
      return Math.round((x - firstTee.x) * crossX + (y - firstTee.y) * crossY);
    }),
  };
}

function startedRound(course = sidehillCourse(), handedness: ShotHandedness = "right") {
  const world = playerWorld(handedness);
  const started = startPlayableRound({
    course,
    world,
    layoutId: "player-pro-slice",
    teeSet: "member",
    pinRotation: "A",
  });
  if (!started.ok) throw new Error(started.reason);
  return { course, world, career: world.playerPro!, round: started.round };
}

describe("ZK-636 M61 release certification", () => {
  it("pins flat, elevation, handedness, sidehill, counter-shape, and matching-shape fixtures", () => {
    const flat = slopeContext({ handedness: "right" });
    const uphill = slopeContext({ handedness: "right", along: 0.2 });
    const downhill = slopeContext({ handedness: "right", along: -0.2 });
    expect(flat).toMatchObject({ targetElevationDelta: 0, sidehill: "flat", naturalCurveBiasTiles: 0 });
    expect(uphill.targetElevationDelta).toBeGreaterThan(0);
    expect(uphill.playsLikeDistanceYards).toBeGreaterThan(flat.playsLikeDistanceYards);
    expect(downhill.targetElevationDelta).toBeLessThan(0);
    expect(downhill.playsLikeDistanceYards).toBeLessThan(flat.playsLikeDistanceYards);

    const fixtures: Array<{
      handedness: ShotHandedness;
      cross: number;
      sidehill: "ball_above_feet" | "ball_below_feet";
      matching: ShotCurveTechnique;
      counter: ShotCurveTechnique;
    }> = [
      { handedness: "right", cross: 1, sidehill: "ball_above_feet", matching: "draw", counter: "fade" },
      { handedness: "right", cross: -1, sidehill: "ball_below_feet", matching: "fade", counter: "draw" },
      { handedness: "left", cross: -1, sidehill: "ball_above_feet", matching: "draw", counter: "fade" },
      { handedness: "left", cross: 1, sidehill: "ball_below_feet", matching: "fade", counter: "draw" },
    ];
    for (const fixture of fixtures) {
      const context = slopeContext(fixture);
      const normal = resolveShotCurve({ shotSlope: context, shotLengthTiles: 20, club: "Driver", technique: "normal" });
      const matching = resolveShotCurve({ shotSlope: context, shotLengthTiles: 20, club: "Driver", technique: fixture.matching });
      const counter = resolveShotCurve({ shotSlope: context, shotLengthTiles: 20, club: "Driver", technique: fixture.counter });
      expect(context.sidehill).toBe(fixture.sidehill);
      expect(Math.sign(matching.intentionalCurveTiles)).toBe(Math.sign(normal.naturalCurveTiles));
      expect(Math.abs(matching.combinedCurveTiles)).toBeGreaterThan(Math.abs(normal.combinedCurveTiles));
      expect(Math.sign(counter.intentionalCurveTiles)).toBe(-Math.sign(normal.naturalCurveTiles));
      expect(Math.abs(counter.combinedCurveTiles)).toBeLessThan(Math.abs(matching.combinedCurveTiles));
      expect(Math.abs(matching.combinedCurveTiles)).toBeLessThanOrEqual(MAX_TOTAL_CURVE_BIAS_TILES);
      expect(Math.abs(counter.combinedCurveTiles)).toBeLessThanOrEqual(MAX_TOTAL_CURVE_BIAS_TILES);
    }
  });

  it("changes caddie club choice at equal geometric distance and commits the exact preview", () => {
    const { career, round } = startedRound(createPlayerProReferenceCourse());
    const downhill = caddieVariant(round, -12);
    const flat = caddieVariant(round, 0);
    const uphill = caddieVariant(round, 12);
    const nominal = new Map([
      ["Driver", 270], ["3 Wood", 235], ["5 Iron", 185], ["7 Iron", 155],
      ["Pitching Wedge", 115], ["Sand Wedge", 78], ["Chip", 38], ["Putter", 28],
    ]);
    const downhillSelection = caddieRecommendation(downhill, career.skills);
    const flatSelection = caddieRecommendation(flat, career.skills);
    const uphillSelection = caddieRecommendation(uphill, career.skills);
    expect(nominal.get(uphillSelection.club)).toBeGreaterThan(nominal.get(flatSelection.club)!);
    expect(downhillSelection.club).toBe(flatSelection.club);
    expect(downhillSelection.power).toBeLessThan(flatSelection.power);
    expect(new Set([
      `${downhillSelection.club}:${downhillSelection.power}`,
      `${flatSelection.club}:${flatSelection.power}`,
      `${uphillSelection.club}:${uphillSelection.power}`,
    ]).size).toBe(3);

    const preview = previewPlayableShot(uphill, career.skills, uphillSelection);
    const committed = commitPlayerShot(uphill, career.skills, uphillSelection);
    expect(committed.pendingShot?.shotSlope).toEqual(preview.shotSlope);
    expect(committed.pendingShot?.sharedOutcome).toEqual(preview.sharedOutcome);
    expect(committed.pendingShot?.sharedOutcome?.physicalRest).toEqual(preview.sharedOutcome?.physicalRest);
  });

  it("keeps fixed-seed active and completed outcomes byte-identical through save normalization", () => {
    const { course, world, career, round } = startedRound();
    const selection = caddieRecommendation(round, career.skills);
    const committed = commitPlayerShot(round, career.skills, selection);
    const repeated = commitPlayerShot(round, career.skills, selection);
    expect(JSON.stringify(repeated.pendingShot)).toBe(JSON.stringify(committed.pendingShot));

    const savedActive = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 1,
      course,
      world: { ...world, playerPro: { ...career, activeRound: committed } },
    });
    expect(savedActive.ok).toBe(true);
    if (!savedActive.ok) return;
    expect(JSON.stringify(savedActive.payload.world.playerPro?.activeRound?.pendingShot)).toBe(JSON.stringify(committed.pendingShot));

    const completed = autoFinishPlayerRound(round, career.skills);
    const settlement = settlePlayerRound(career, completed);
    expect(settlement.round).not.toBeNull();
    const savedCompleted = normalizeLoadedSaveResult({
      schemaVersion: 14,
      savedAt: 2,
      course,
      world: { ...world, playerPro: settlement.career },
    });
    expect(savedCompleted.ok).toBe(true);
    if (!savedCompleted.ok) return;
    expect(JSON.stringify(savedCompleted.payload.world.playerPro?.rounds[0])).toBe(JSON.stringify(settlement.round));
    expect(settlePlayerRound(savedCompleted.payload.world.playerPro!, completed).round).toBeNull();
  });

  it("leaves historical traces without slope evidence unchanged and does not re-adjudicate completion", () => {
    const career = createDefaultPlayerPro({ seed: M61_SEED, name: "Legacy Certifier" });
    const historical = {
      id: "m61-legacy-round",
      kind: "casual" as const,
      courseId: "legacy-course",
      courseName: "Legacy Course",
      week: 4,
      strokes: 4,
      penalties: 0,
      par: 4,
      scoreToPar: 0,
      result: "complete" as const,
      earnings: 0,
      scorecard: [],
      shots: [{ id: "m61-legacy-shot", seed: 7 }],
      evidence: [],
      skillGains: {},
    };
    const normalized = normalizePlayerPro({ ...career, rounds: [historical] }, { seed: M61_SEED });
    expect(normalized.rounds[0].shots).toEqual(historical.shots);
    expect(normalized.rounds[0]).toMatchObject({
      result: "complete",
      strokes: 4,
      penalties: 0,
      scoreToPar: 0,
    });
    expect(normalized.rounds[0].shots[0].shotSlope).toBeUndefined();
  });

  it("keeps AI preview, commit, replay, and design evidence on one physical outcome", () => {
    const course = sidehillCourse();
    const hole = course.holes[0];
    const plan = generateStrategicHolePlan({
      course,
      hole,
      par: 5,
      capabilities,
      personality,
      includeGreenLandingZones: false,
    });
    const snapshot = liveCourseSnapshot({ course, teeSet: "member", pinRotation: "A" });
    const args = {
      snapshot,
      capabilities,
      holeId: hole.id!,
      shotNumber: 1,
      from: plan.chosen.from,
      lie: "tee",
      intent: plan.chosen,
      seed: plan.chosen.previewSeed!,
    };
    const preview = previewLiveShot(args);
    const committed = resolveLiveShot(args);
    expect(preview).toEqual(committed);
    expect(committed.shotSlope).toEqual(plan.chosen.shotSlope);
    expect(committed.landing).toEqual(plan.chosen.previewLanding);
    expect(committed.rest).toEqual(plan.chosen.previewRest);
    expect(committed.sharedOutcome?.physicalRest.x).toBeCloseTo(committed.rest.x, 3);
    expect(committed.sharedOutcome?.physicalRest.y).toBeCloseTo(committed.rest.y, 3);
    expect(committed.slopeExplanation).toContain("plays-like:");

    const { world, career, round } = startedRound(course);
    const completed = autoFinishPlayerRound(round, career.skills);
    const settlement = settlePlayerRound(career, completed);
    if (!settlement.round) throw new Error("M61 certification round did not settle");
    const recorded = recordPlayerRoundArchitecture(world, completed, settlement.round);
    const review = buildArchitectureReview(course, recorded.world, {
      ...defaultArchitectureFilters(course),
      sourceSegment: "player-pro",
    });
    expect(review.evidence).toHaveLength(completed.shots.length);
    expect(review.evidence.every((item) => item.shotSlope && item.slopeExplanation)).toBe(true);
    expect(review.evidence.every((item) => item.physicalRest && item.rest)).toBe(true);
    expect(review.overlay.traces.some((trace) => trace.label?.includes("sidehill:"))).toBe(true);
  });

  it("keeps slope analysis, previews, strategy, rounds, and live stepping inside release budgets", () => {
    const course = sidehillCourse();
    const { world, career, round } = startedRound(course);
    const selection = caddieRecommendation(round, career.skills);

    const analysisStarted = performance.now();
    for (let index = 0; index < 5_000; index++) {
      analyzeShotSlope({
        course,
        from: course.holes[index % course.holes.length].tee!,
        to: course.holes[index % course.holes.length].green!,
        yardsPerTile: course.yardsPerTile,
        handedness: index % 2 ? "left" : "right",
      });
    }
    const analysisMs = performance.now() - analysisStarted;

    const previewStarted = performance.now();
    for (let index = 0; index < 250; index++) previewPlayableShot(round, career.skills, selection);
    const previewMs = performance.now() - previewStarted;

    const strategyStarted = performance.now();
    for (let index = 0; index < 20; index++) {
      generateStrategicHolePlan({
        course,
        hole: course.holes[index % course.holes.length],
        par: 5,
        capabilities: { ...capabilities, seed: M61_SEED + index },
        personality,
        includeGreenLandingZones: false,
      });
    }
    const strategyMs = performance.now() - strategyStarted;

    const roundStarted = performance.now();
    for (let index = 0; index < 3; index++) {
      const completed = autoFinishPlayerRound({ ...round, rngSeed: round.rngSeed + index }, career.skills);
      expect(completed.phase).toBe("round_complete");
      expect(completed.shots.length).toBeLessThanOrEqual(240);
    }
    const roundMs = performance.now() - roundStarted;

    const liveStarted = performance.now();
    const live = createLiveState(course, world, 0);
    for (let index = 0; index < 180 && !live.dayOver; index++) stepLive(live, course, 5);
    const liveMs = performance.now() - liveStarted;

    expect(analysisMs).toBeLessThan(1_500);
    expect(previewMs).toBeLessThan(2_500);
    expect(strategyMs).toBeLessThan(5_000);
    expect(roundMs).toBeLessThan(15_000);
    expect(liveMs).toBeLessThan(15_000);
  }, 60_000);
});
