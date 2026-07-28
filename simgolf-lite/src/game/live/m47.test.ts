import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { getGolferProfile } from "../sim/golferProfiles";
import { mulberry32 } from "../../utils/rng";
import { createGolferCapabilities } from "./capabilities";
import { generateStrategicHolePlan } from "./strategicOptions";
import { buildGolferRound, entryPoint } from "./golfer";
import type { Personality } from "./personality";

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
});
