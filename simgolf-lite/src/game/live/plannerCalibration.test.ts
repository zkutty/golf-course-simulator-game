import { describe, expect, it } from "vitest";
import type { Course } from "../models/types";
import type { GolferCapabilities } from "./m47Types";
import { createGolferCapabilities } from "./capabilities";
import { liveCourseSnapshot } from "./livePhysics";
import { followUpIntent, generateRecoveryCandidates, generateStrategicHolePlan } from "./strategicOptions";
import { planGreenLandingZones } from "./greenLandingStrategy";

const personality = { skill: .7, consistency: .7, patience: .5, spendPropensity: .5,
  prefs: { difficulty: 0, scenery: 0, price: 0 } };
function capabilities(power: number): GolferCapabilities {
  return { ...createGolferCapabilities({ personality, seed: 551 }), power, accuracy: 70, irons: 65,
    shortGame: 75, recovery: 75, consistency: 70, riskStyle: "balanced" };
}
function course(yards = 120): Course {
  const tee = { x: 3, y: 10 };
  const green = { x: 3 + yards / 10, y: 10 };
  const tiles: Course["tiles"] = new Array(1600).fill("fairway");
  tiles[10 * 80 + green.x] = "green";
  return { name: "Planner calibration", width: 80, height: 20, tiles, elevations: new Array(1600).fill(0),
    holes: [{ id: "range", tee, green, parMode: "MANUAL", parManual: 4 }],
    obstacles: [], buildings: [], yardsPerTile: 10, baseGreenFee: 60, condition: .8 };
}

describe("ZK1396 modern AI planning uses frozen actor carry", () => {
  it("chooses a longer club for the shorter actor on the same approach", () => {
    const c = course();
    const selections = [10, 90].map((power) => {
      const golfer = capabilities(power);
      const snapshot = liveCourseSnapshot({ course: c, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities: golfer });
      return followUpIntent({ course: c, hole: c.holes[0], from: c.holes[0].tee!, lie: "fairway",
        capabilities: golfer, personality, shotNumber: 2, snapshot });
    });
    expect(selections[0].club).toBe("5 Iron");
    expect(selections[1].club).toBe("7 Iron");
  });

  it("does not apply a second power trait scale when ranking a frozen snapshot", () => {
    const c = course(150);
    const snapshot = liveCourseSnapshot({ course: c, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities: capabilities(20) });
    const plans = [20, 90].map((power) => generateStrategicHolePlan({ course: c, hole: c.holes[0], par: 4,
      capabilities: capabilities(power), personality, snapshot, includeGreenLandingZones: false, includeSelectedPreview: false }));
    expect(plans[0].chosen.club).toBe(plans[1].chosen.club);
    expect(plans[0].chosen.power).toBe(plans[1].chosen.power);
    expect(plans[0].chosen.expectedStrokes).toBe(plans[1].chosen.expectedStrokes);
    const legacy = [20, 90].map((power) => generateStrategicHolePlan({ course: c, hole: c.holes[0], par: 4,
      capabilities: capabilities(power), personality, includeGreenLandingZones: false, includeSelectedPreview: false }));
    expect(legacy[0].chosen.power).not.toBe(legacy[1].chosen.power);
  });

  it("reports green carry utilization from the frozen driver range", () => {
    const c = course();
    const golfer = capabilities(20);
    const snapshot = liveCourseSnapshot({ course: c, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities: golfer });
    const candidates = planGreenLandingZones({ course: c, hole: c.holes[0], from: c.holes[0].tee!, lie: "fairway",
      capabilities: golfer, personality, snapshot });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const expected = Math.hypot(candidate.target.x - c.holes[0].tee!.x, candidate.target.y - c.holes[0].tee!.y)
        * c.yardsPerTile / snapshot.distanceProfile!.clubCarryYards.driver;
      expect(candidate.carryUtilization).toBeCloseTo(expected, 2);
    }
  });

  it("uses the same frozen carry authority for recovery range selection", () => {
    const c = course(60);
    const snapshot = liveCourseSnapshot({ course: c, teeSet: "member", pinRotation: "A", modernShotModel: true, capabilities: capabilities(20) });
    const options = [20, 90].map((power) => generateRecoveryCandidates({ course: c, hole: c.holes[0], from: c.holes[0].tee!,
      lie: "rough", capabilities: capabilities(power), personality, snapshot, sampleCount: 1, shotNumber: 2 }));
    expect(options[0].length).toBeGreaterThan(0);
    expect(options[0].map((candidate) => ({ club: candidate.club, power: candidate.power })))
      .toEqual(options[1].map((candidate) => ({ club: candidate.club, power: candidate.power })));
  });
});
