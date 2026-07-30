import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { getGolferProfile } from "../sim/golferProfiles";
import { mulberry32 } from "../../utils/rng";
import { createGolferCapabilities } from "./capabilities";
import { capabilitiesToPlayerSkills } from "./capabilities";
import { followUpIntent, generateStrategicHolePlan } from "./strategicOptions";
import { buildGolferRound, entryPoint } from "./golfer";
import { liveCourseSnapshot, resolveLiveShot } from "./livePhysics";
import { resolvePlayableShot } from "../playerPro/playerPro";
import { createControlledRoundSnapshotV2 } from "../rules/roundSnapshot";
import type { Personality } from "./personality";
import { createM47CertificationCourse } from "../testing/m47Certification";
import type { GolferCapabilities } from "./m47Types";

function testPersonality(over: Partial<Personality> = {}): Personality {
  return {
    skill: 0.6,
    consistency: 0.6,
    patience: 0.5,
    spendPropensity: 0.5,
    prefs: { difficulty: 0, scenery: 0, price: 0 },
    ...over,
  };
}

function course(): Course {
  const width = 56;
  const height = 26;
  const tiles: Terrain[] = Array.from({ length: width * height }, () => "fairway");
  const tee = { x: 4, y: 13 };
  const green = { x: 48, y: 13 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = green.y - 1; y <= green.y + 1; y++) for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "green";
  for (let y = 2; y < height - 2; y++) tiles[y * width + 26] = y === 5 || y === 20 ? "fairway" : "water";
  return {
    name: "M47 reference",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ id: "m47-hole-1", tee, green, parMode: "MANUAL", parManual: 4, name: "The Decision" }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: .8,
  };
}

describe("M47 live golfer contracts", () => {
  it("creates deterministic bounded capabilities with recognizable dimensions", () => {
    const personality = testPersonality({ skill: .72, consistency: .64, prefs: { difficulty: .7, scenery: .2, price: 0 } });
    const a = createGolferCapabilities({ personality, seed: 42 });
    const b = createGolferCapabilities({ personality, seed: 42 });
    expect(a).toEqual(b);
    expect(a.power).toBeGreaterThan(0);
    expect(a.accuracy).toBeGreaterThan(0);
    expect(a.riskStyle).toBe("aggressive");
    for (const key of ["power", "accuracy", "irons", "shortGame", "recovery", "consistency"] as const) {
      expect(a[key]).toBeGreaterThanOrEqual(0);
      expect(a[key]).toBeLessThanOrEqual(100);
    }
  });

  it("retains rejected alternatives and changes the chosen route by risk style", () => {
    const c = course();
    const hole = c.holes[0];
    const conservative = createGolferCapabilities({ personality: testPersonality({ skill: .5, consistency: .7, prefs: { difficulty: -.8, scenery: 0, price: 0 } }), seed: 3 });
    const aggressive = createGolferCapabilities({ personality: testPersonality({ skill: .9, consistency: .9, prefs: { difficulty: .9, scenery: 0, price: 0 } }), seed: 4 });
    const safePlan = generateStrategicHolePlan({ course: c, hole, par: 4, capabilities: conservative, personality: testPersonality({ prefs: { difficulty: -.8, scenery: 0, price: 0 } }) });
    const heroPlan = generateStrategicHolePlan({ course: c, hole, par: 4, capabilities: aggressive, personality: testPersonality({ prefs: { difficulty: .9, scenery: 0, price: 0 } }) });
    expect(safePlan.rejected.length).toBeGreaterThan(0);
    expect(heroPlan.rejected.length).toBeGreaterThan(0);
    expect(safePlan.chosen.kind).not.toBe(heroPlan.chosen.kind);
  });

  it("executes selected intents through shared physics and stores evidence", () => {
    const c = course();
    const personality = testPersonality({ skill: .7, consistency: .75, prefs: { difficulty: .4, scenery: .3, price: 0 } });
    const capabilities = createGolferCapabilities({ personality, seed: 99 });
    const first = buildGolferRound({
      course: c,
      profile: getGolferProfile("SCRATCH", c),
      entry: entryPoint(c),
      rng: mulberry32(123),
      personality,
      capabilities,
    });
    const second = buildGolferRound({
      course: c,
      profile: getGolferProfile("SCRATCH", c),
      entry: entryPoint(c),
      rng: mulberry32(123),
      personality,
      capabilities,
    });
    expect(first.holePlans?.[0].chosen).toBeDefined();
    expect(first.holePlans?.[0].rejected.length).toBeGreaterThan(0);
    expect(first.shotOutcomes?.length).toBeGreaterThan(0);
    expect(first.holeReactions?.[0].facts.length).toBeGreaterThan(0);
    expect(first.shotOutcomes).toEqual(second.shotOutcomes);
    expect(first.holeReactions).toEqual(second.holeReactions);
    expect(first.shotOutcomes?.every((outcome) => outcome.rest && outcome.landing)).toBe(true);
  });

  it("keeps Player Pro and live shared physical fields byte-equivalent", () => {
    const c = course();
    const personality = testPersonality({ skill: .7, consistency: .75, prefs: { difficulty: .4, scenery: .3, price: 0 } });
    const capabilities = createGolferCapabilities({ personality, seed: 99 });
    const frozen = createControlledRoundSnapshotV2({
      width: c.width,
      height: c.height,
      inBounds: Array.from({ length: c.width * c.height }, () => true),
      penaltyMask: Array.from({ length: c.width * c.height }, () => false),
      holeClassifications: [{ holeId: "m47-hole-1", red: [], yellow: [] }],
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) throw new Error(frozen.error.message);
    const snapshot = liveCourseSnapshot({
      course: c,
      teeSet: "member",
      pinRotation: "A",
      rulesSnapshot: frozen.value,
    });
    const intent = generateStrategicHolePlan({
      course: c,
      hole: c.holes[0],
      par: 4,
      capabilities,
      personality,
    }).chosen;
    const sharedArgs = {
      snapshot,
      capabilities,
      holeId: "m47-hole-1",
      shotNumber: 1,
      from: intent.from,
      lie: "tee",
      intent,
      seed: 4781,
    } as const;
    const live = resolveLiveShot(sharedArgs);
    const player = resolvePlayableShot({
      snapshot,
      holeId: sharedArgs.holeId,
      shotNumber: sharedArgs.shotNumber,
      from: sharedArgs.from,
      lie: sharedArgs.lie,
      skills: capabilitiesToPlayerSkills(capabilities),
      selection: {
        club: intent.club,
        aim: intent.target,
        power: intent.power,
        technique: intent.technique,
        flightProfile: intent.flightProfile,
      },
      seed: sharedArgs.seed,
    });
    expect(live.sharedOutcome).toEqual(player.sharedOutcome);
    expect(live.ruling).toEqual(player.ruling);
    expect(live.relief).toEqual(player.relief);
    expect(live.finalPosition).toEqual(player.finalPosition);
    expect(live.flightProfile).toBe(player.flightProfile);
  });

  it("keeps a strategic follow-up on the rules-classified playable tile at a penalty boundary", () => {
    const c = createM47CertificationCourse(36);
    c.obstacles = c.holes.flatMap((hole, index) => {
      if (!hole.tee || !hole.green) return [];
      return [{
        type: index % 5 === 0 ? "rock" as const : index % 3 === 0 ? "bush" as const : "tree" as const,
        x: Number(((hole.tee.x + hole.green.x) / 2).toFixed(3)),
        y: Number((((hole.tee.y + hole.green.y) / 2) + (index % 2 ? 0.65 : -0.65)).toFixed(3)),
      }];
    });
    const personality = testPersonality({ skill: .7, consistency: .72 });
    const capabilities: GolferCapabilities = {
      version: 1,
      seed: 50_553,
      power: 78,
      accuracy: 82,
      irons: 80,
      shortGame: 76,
      recovery: 88,
      consistency: 84,
      riskTolerance: .52,
      challengeSeeking: .5,
      sceneryAffinity: .5,
      valueSensitivity: .5,
      riskStyle: "balanced",
      strengths: ["recovery", "accuracy"],
      weaknesses: ["power", "shortGame"],
    };
    const snapshot = liveCourseSnapshot({ course: c, teeSet: "member", pinRotation: "A" });
    const hole = c.holes[24];
    const from = { x: 18.397, y: 76.425 };
    const intent = followUpIntent({
      course: c,
      hole: { ...hole, tee: from },
      from,
      lie: "fairway",
      capabilities,
      personality,
      shotNumber: 1,
      snapshot,
    });
    const outcome = resolveLiveShot({
      snapshot,
      capabilities,
      holeId: hole.id!,
      shotNumber: 2,
      from,
      lie: "fairway",
      intent,
      seed: 19_181_415,
    });

    const floorIndex = Math.floor(outcome.rest.y) * c.width + Math.floor(outcome.rest.x);
    const roundedIndex = Math.round(outcome.rest.y) * c.width + Math.round(outcome.rest.x);
    expect(outcome.ruling).toMatchObject({ status: "penalty", penaltyStrokes: 1 });
    expect(outcome.relief).toMatchObject({ status: "resolved", type: "lateral" });
    expect(c.tiles[floorIndex]).toBe("fairway");
    expect(c.tiles[roundedIndex]).toBe("water");
    expect(outcome.lieAfter).toBe("fairway");

    const nextIntent = followUpIntent({
      course: c,
      hole: { ...hole, tee: outcome.rest },
      from: outcome.rest,
      lie: outcome.lieAfter,
      capabilities,
      personality,
      shotNumber: 2,
      snapshot,
    });
    const nextOutcome = resolveLiveShot({
      snapshot,
      capabilities,
      holeId: hole.id!,
      shotNumber: 3,
      from: outcome.rest,
      lie: outcome.lieAfter,
      intent: nextIntent,
      seed: 1_337,
    });
    expect(nextOutcome.lieBefore).not.toMatch(/^(water|wetland|out_of_bounds)$/);
  });
});
